const rawPort = process.env.PORT ?? '3001';
const parsedPort = parseInt(rawPort, 10);

export const PORT = Number.isFinite(parsedPort) ? parsedPort : 3001;
export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';
export const BACKEND_PUBLIC_URL =
  process.env.BACKEND_PUBLIC_URL?.replace(/\/+$/, '') ?? `http://localhost:${PORT}`;
