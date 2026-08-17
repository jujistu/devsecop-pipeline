import { ApolloServer } from '@apollo/server';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { expressMiddleware } from '@apollo/server/express4';
import cors from 'cors';
import express, { Request } from 'express';
import http from 'http';
import { json } from 'body-parser';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import axios from 'axios';
import { schema } from './schema';
import { context as defaultContext } from './context';
import { renameWithExt as defaultRenameWithExt } from './utils/file.util';
import { pdfProcessorUrl } from './utils/pdfProcessor.util';
import {
  createAskHandler,
  createBookIndex,
  createExplainHandler,
  createSummaryHandler,
  DeepSeekLlm,
  type AskAuthUser,
  type BookIndex,
  type LlmClient,
  type SummaryAuthUser,
  type ExplainAuthUser,
} from './bookAi';
import { getObjectStore } from './objectStore';
import { Book } from './database/schemas/book.schema';
import { canWriteJobId as defaultCanWriteJobId } from './repository/book.repository';

const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');

type RequestContext = Awaited<ReturnType<typeof defaultContext>>;

export type HttpAppDeps = {
  createContext?: typeof defaultContext;
  authenticateUser?: (
    req: Request
  ) => Promise<AskAuthUser | ExplainAuthUser | SummaryAuthUser | null>;
  canWriteJobId?: typeof defaultCanWriteJobId;
  postToPdfProcessor?: (
    path: '/index-pdf' | '/process-pdf',
    form: any
  ) => Promise<{ status: number; data: any }>;
  renameWithExt?: typeof defaultRenameWithExt;
  bookIndex?: BookIndex;
  explainLlm?: LlmClient;
  askLlm?: LlmClient;
  summaryLlm?: LlmClient;
  getSummaryCache?: (
    userId: string,
    documentOrJobId: string
  ) => Promise<string | null>;
  saveSummaryCache?: (
    userId: string,
    documentOrJobId: string,
    summaryText: string
  ) => Promise<void>;
  uploadDir?: string;
  enableWebSocket?: boolean;
};

function cleanupUpload(file: any) {
  try {
    if (!file) return;
    const paths = [file.path, file.path ? `${file.path}.pdf` : null];
    for (const p of paths) {
      if (!p) continue;
      try {
        fs.unlink(p, () => {});
      } catch {}
    }
  } catch {}
}

function createDefaultBookIndex(): BookIndex {
  return createBookIndex({
    objectStore: getObjectStore(),
    lookup: async (userId, documentOrJobId) => {
      const book = await Book.findOne({
        userId,
        jobId: documentOrJobId,
      }).lean();
      if (!book) return null;
      return {
        jobId: (book as any).jobId,
        documentId: (book as any).jobId,
        indexStatus: (book as any).indexStatus ?? 'queued',
        indexError: (book as any).indexError ?? null,
        contextObjectKey: (book as any).contextObjectKey ?? null,
        title: (book as any).title ?? null,
      };
    },
    async markFailed(userId, documentOrJobId, error) {
      await Book.updateOne(
        { userId, jobId: documentOrJobId },
        { $set: { indexStatus: 'failed', indexError: error } }
      );
    },
  });
}

export async function createHttpApp(deps: HttpAppDeps = {}) {
  const createContext = deps.createContext || defaultContext;
  const authenticateUser =
    deps.authenticateUser ||
    (async (req: Request) => {
      const ctx = (await createContext({ req })) as RequestContext;
      return ctx.user?.id ? { id: String(ctx.user.id) } : null;
    });
  const canWriteJobId = deps.canWriteJobId || defaultCanWriteJobId;
  const renameWithExt = deps.renameWithExt || defaultRenameWithExt;
  const postToPdfProcessor =
    deps.postToPdfProcessor ||
    (async (path: '/index-pdf' | '/process-pdf', form: any) =>
      axios.post(pdfProcessorUrl(path), form, {
        headers: {
          ...form.getHeaders(),
        },
      }));
  const bookIndex = deps.bookIndex || createDefaultBookIndex();
  const explainLlm = deps.explainLlm || new DeepSeekLlm();
  const askLlm = deps.askLlm || new DeepSeekLlm();
  const summaryLlm = deps.summaryLlm || new DeepSeekLlm();
  const getSummaryCache =
    deps.getSummaryCache ||
    (async (userId: string, documentOrJobId: string) => {
      const book = await Book.findOne({
        userId,
        jobId: documentOrJobId,
      })
        .select('summaryText')
        .lean();
      const text = (book as any)?.summaryText;
      return typeof text === 'string' && text.trim() ? text : null;
    });
  const saveSummaryCache =
    deps.saveSummaryCache ||
    (async (userId: string, documentOrJobId: string, summaryText: string) => {
      await Book.updateOne(
        { userId, jobId: documentOrJobId },
        {
          $set: {
            summaryText,
            summaryGeneratedAt: new Date(),
          },
        }
      );
    });

  const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;
  const uploadDest = multer({
    dest: deps.uploadDir || 'uploads/',
    limits: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: 1 },
    fileFilter: (_req: any, file: any, cb: any) => {
      const type = String(file.mimetype || '').toLowerCase();
      if (type.includes('pdf')) {
        cb(null, true);
      } else {
        cb(new Error('Only PDF files are allowed'));
      }
    },
  });

  const authenticate = async (req: any, res: any, next: any) => {
    try {
      const user = await authenticateUser(req);
      if (!user?.id) {
        return res.status(401).send('Unauthorized');
      }
      req.authUser = user;
      next();
    } catch {
      return res.status(401).send('Unauthorized');
    }
  };

  const handleMulter = (req: any, res: any, next: any) => {
    uploadDest.single('file')(req, res, (err: any) => {
      if (err) {
        cleanupUpload(req.file);
        if (err instanceof multer.MulterError) {
          return res
            .status(400)
            .send(err.code === 'LIMIT_FILE_SIZE' ? 'File too large' : 'Invalid upload');
        }
        return res.status(400).send(err.message || 'Invalid upload');
      }
      next();
    });
  };

  const assertJobOwnership = async (req: any) => {
    const user = req.authUser;
    if (!user) return false;
    const jobId = req.body.jobId || req.body.documentId;
    return canWriteJobId(String(user.id), jobId);
  };

  const app = express();
  const httpServer = http.createServer(app);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  let serverCleanup: { dispose: () => void | Promise<void> } | null = null;
  if (deps.enableWebSocket !== false) {
    const wsServer = new WebSocketServer({
      server: httpServer,
      path: '/subscriptions',
    });
    serverCleanup = useServer(
      {
        schema,
        onConnect: async (ctx: any) => {
          const connectionParams = ctx.connectionParams || {};
          const token =
            connectionParams.token ||
            connectionParams.authorization ||
            connectionParams.Authorization ||
            '';
          const fakeReq = {
            headers: {
              authorization: String(token).startsWith('Bearer ')
                ? String(token)
                : `Bearer ${String(token)}`,
            },
          } as Request;
          const user = await authenticateUser(fakeReq);
          if (!user?.id) {
            throw new Error('Unauthorized: missing or invalid token');
          }
        },
        context: async (ctx: any) => {
          const connectionParams = ctx.connectionParams || {};
          const token =
            connectionParams.token ||
            connectionParams.authorization ||
            connectionParams.Authorization ||
            '';
          const fakeReq = {
            headers: {
              authorization: String(token).startsWith('Bearer ')
                ? String(token)
                : `Bearer ${String(token)}`,
            },
          } as Request;
          const user = await authenticateUser(fakeReq);
          if (!user?.id) {
            throw new Error('Unauthorized: missing or invalid token');
          }
          return { user };
        },
      },
      wsServer
    );
  }

  const server = new ApolloServer({
    schema,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              if (serverCleanup) {
                await serverCleanup.dispose();
              }
            },
          };
        },
      },
    ],
  });

  await server.start();

  app.use(bodyParser.json());
  app.use(express.json());

  app.post('/upload', authenticate, handleMulter, async (req: any, res) => {
    try {
      const user = req.authUser;
      const file = req.file;
      const userId = user.id;
      const title = req.body.title;
      const jobId = req.body.jobId;

      if (!file || !userId || !title || !jobId) {
        cleanupUpload(file);
        return res.status(400).send('File, userId and title and jobId are required');
      }

      if (!(await assertJobOwnership(req))) {
        cleanupUpload(file);
        return res.status(403).send('Forbidden: jobId not owned by this user');
      }

      try {
        renameWithExt(file);
        const form = new FormData();
        form.append('userId', userId);
        form.append('title', title);
        form.append('file', fs.createReadStream(file.path + '.pdf'));
        form.append('jobId', jobId);
        const response = await postToPdfProcessor('/process-pdf', form);
        res.status(response.status).send(response.data);
      } catch (error: any) {
        res
          .status(500)
          .send(
            `Error processing file --> ${error.response?.data?.error ?? error.message}`
          );
      } finally {
        cleanupUpload(file);
      }
    } catch (e) {
      res.status(500).send('Error uploading file');
    }
  });

  app.post('/index', authenticate, handleMulter, async (req: any, res) => {
    try {
      const user = req.authUser;
      const file = req.file;
      const userId = user.id;
      const title = req.body.title;
      const jobId = req.body.jobId || req.body.documentId;

      if (!file || !userId || !title || !jobId) {
        cleanupUpload(file);
        return res.status(400).send('File, title and jobId (or documentId) are required');
      }

      if (!(await assertJobOwnership(req))) {
        cleanupUpload(file);
        return res.status(403).send('Forbidden: jobId not owned by this user');
      }

      try {
        renameWithExt(file);
        const form = new FormData();
        form.append('userId', userId);
        form.append('title', title);
        form.append('jobId', jobId);
        form.append('file', fs.createReadStream(file.path + '.pdf'));
        const response = await postToPdfProcessor('/index-pdf', form);
        res.status(response.status).send(response.data);
      } catch (error: any) {
        res.status(500).send({
          error:
            error.response?.data?.error ||
            error.message ||
            'Error starting Cloud indexing',
        });
      } finally {
        cleanupUpload(file);
      }
    } catch (e) {
      res.status(500).send('Error starting Cloud indexing');
    }
  });

  app.post(
    '/explain',
    createExplainHandler({
      llm: explainLlm,
      bookIndex,
      getUser: authenticateUser,
    })
  );

  app.post(
    '/ask',
    createAskHandler({
      llm: askLlm,
      bookIndex,
      getUser: authenticateUser,
    })
  );

  app.post(
    '/summary',
    createSummaryHandler({
      llm: summaryLlm,
      bookIndex,
      getUser: authenticateUser,
      getSummaryCache,
      saveSummaryCache,
    })
  );

  app.use(
    '/',
    cors<cors.CorsRequest>(),
    json(),
    expressMiddleware(server, {
      context: createContext,
    })
  );

  return {
    app,
    httpServer,
    apolloServer: server,
    async close() {
      await server.stop();
      if (!httpServer.listening) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
