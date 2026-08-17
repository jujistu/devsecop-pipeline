import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    health: {
      executor: "constant-vus",
      vus: 5,
      duration: "30s",
      exec: "healthChecks",
    },
    index_submit: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "30s", target: 5 },
        { duration: "30s", target: 10 },
        { duration: "30s", target: 0 },
      ],
      exec: "submitIndexJob",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<2000"],
  },
};

const backendUrl = __ENV.BACKEND_URL || "http://127.0.0.1:3000";
const processorUrl = __ENV.PDF_PROCESSOR_URL || "http://127.0.0.1:8000";
const samplePdf = open("../../quotiiPdfProcessor/tests/fixtures/sample.pdf", "b");

export function healthChecks() {
  const backend = http.get(`${backendUrl}/health`);
  const processor = http.get(`${processorUrl}/health`);

  check(backend, {
    "backend health 200": (res) => res.status === 200,
  });
  check(processor, {
    "processor health 200": (res) => res.status === 200,
  });
  sleep(1);
}

export function submitIndexJob() {
  const guestId = `k6-guest-${__VU}-${Date.now()}`;
  const register = http.post(
    `${backendUrl}/`,
    JSON.stringify({
      query:
        "mutation($guestId: String!) { registerGuest(guestId: $guestId) { accessToken } }",
      variables: { guestId },
    }),
    {
      headers: { "Content-Type": "application/json" },
    }
  );

  check(register, {
    "registerGuest 200": (res) => res.status === 200,
    "registerGuest returned token": (res) =>
      !!res.json("data.registerGuest.accessToken"),
  });

  const token = register.json("data.registerGuest.accessToken");
  const jobId = `k6-job-${__VU}-${Date.now()}`;
  const payload = {
    title: "k6 sample",
    jobId,
    file: http.file(samplePdf, "sample.pdf", "application/pdf"),
  };
  const submit = http.post(`${backendUrl}/index`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });

  check(submit, {
    "index accepted": (res) => res.status === 202,
    "index response queued": (res) => res.json("index_status") === "queued",
  });
  sleep(1);
}
