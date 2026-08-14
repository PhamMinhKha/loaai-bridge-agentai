import { Agent } from "./agent.js";

// Echo/mock agent for local testing without a real backend.
export class MockAdapter extends Agent {
    async sendMessage({ text }) {
        const t = (text || "").trim();
        if (/thời tiết/i.test(t)) {
            return { text: "Hôm nay trời nắng đẹp, nhiệt độ khoảng 29 độ C." };
        }
        if (/bạn là ai/i.test(t)) {
            return { text: "Tôi là Voice Gateway demo, chạy qua agent mock." };
        }
        return { text: `Bạn vừa nói: "${t}"` };
    }
}
