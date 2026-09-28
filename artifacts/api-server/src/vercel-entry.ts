// Serverless entry for Vercel: export the Express app as the request handler.
// The long-running alert scheduler from index.ts does not run here.
import app from "./app";

export default app;
