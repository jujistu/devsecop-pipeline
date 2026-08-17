# syntax=docker/dockerfile:1.7

FROM node:26-alpine AS deps

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn config set network-timeout 600000 -g && \
    yarn install --frozen-lockfile --production=true && \
    yarn cache clean


FROM node:26-alpine AS build

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn config set network-timeout 600000 -g && \
    yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

RUN yarn build


FROM node:26-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /opt/yarn* \
           /usr/local/bin/yarn \
           /usr/local/bin/yarnpkg && \
    addgroup -S quotii && \
    adduser -S quotii -G quotii

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

RUN mkdir -p uploads && chown -R quotii:quotii /app

USER quotii

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
