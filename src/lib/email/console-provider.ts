import { logger } from "@/lib/logger";
import type { EmailProvider, RenderedEmail } from "@/lib/email/types";

export class ConsoleEmailProvider implements EmailProvider {
  async send(message: RenderedEmail) {
    const id = `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    logger.info("email.console.send", {
      id,
      to: message.to,
      from: message.from,
      subject: message.subject
    });

    console.log(
      [
        "",
        "--- Email (console provider) ---",
        `To: ${message.to}`,
        `From: ${message.from}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        "---------------------------------",
        ""
      ].join("\n")
    );

    return { id };
  }
}
