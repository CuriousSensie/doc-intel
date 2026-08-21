import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { ConsoleEmailProvider } from "@/lib/email/console-provider";
import { SmtpEmailProvider } from "@/lib/email/smtp-provider";
import type { EmailProvider, RenderedEmail } from "@/lib/email/types";

export function applyDevRecipientOverride(message: RenderedEmail): RenderedEmail {
  const devRecipient = env.EMAIL_DEV_RECIPIENT;

  if (!devRecipient || devRecipient === message.to) {
    return message;
  }

  logger.warn("email.dev_recipient.reroute", {
    originalTo: message.to,
    devRecipient
  });

  return {
    ...message,
    to: devRecipient,
    subject: `[dev -> ${message.to}] ${message.subject}`
  };
}

function createProvider(): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case "smtp":
      return new SmtpEmailProvider();
    case "console":
      return new ConsoleEmailProvider();
    default:
      return new ConsoleEmailProvider();
  }
}

let cachedProvider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (!cachedProvider) {
    cachedProvider = createProvider();
  }

  return cachedProvider;
}

export async function sendRenderedEmail(message: RenderedEmail) {
  const provider = getEmailProvider();
  return provider.send(applyDevRecipientOverride(message));
}
