import { handleMcp } from "../src/handler.js";

export const config = { maxDuration: 30 };

export default { fetch: (request: Request) => handleMcp(request) };
