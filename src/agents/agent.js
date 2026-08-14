// Agent interface — subclasses implement sendMessage / streamMessage
export class Agent {
    async sendMessage() {
        throw new Error("sendMessage() not implemented");
    }

    async *streamMessage() {
        throw new Error("streamMessage() not implemented");
    }
}
