import { OpenClawAdapter } from "./openclaw.js";
import { HermesAdapter } from "./hermes.js";
import { MockAdapter } from "./mock.js";

export function createAgent(config) {
    switch (config.agentProvider) {
        case "openclaw":
            return new OpenClawAdapter(config.openclaw);
        case "hermes":
            return new HermesAdapter(config.hermes);
        case "mock":
            return new MockAdapter();
        default:
            throw new Error(`Unknown agent provider: ${config.agentProvider}`);
    }
}
