import { handleApi } from "../src/api.js";

export const config = { maxDuration: 30 };

export default { fetch: (request: Request) => handleApi(request) };
