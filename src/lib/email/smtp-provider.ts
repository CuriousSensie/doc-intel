import nodemailer from "nodemailer";

import { env, requireEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { EmailProvider, RenderedEmail } from "@/lib/email/types";

export class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: nodemailer.Transporter;

  constructor() {
    const host = requireEnv("SMTP_HOST");
    const port = requireEnv("SMTP_PORT");
    const user = requireEnv("SMTP_USER");
    const pass = requireEnv("SMTP_PASSWORD");

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: env.SMTP_SECURE,
      auth: { user, pass }
    });
  }

  async send(message: RenderedEmail) {
    const info = await this.transporter.sendMail({
      to: message.to,
      from: message.from,
      subject: message.subject,
      html: message.html,
      text: message.text
    });

    logger.info("email.smtp.send", {
      id: info.messageId,
      to: message.to,
      subject: message.subject
    });

    return { id: info.messageId };
  }
}
