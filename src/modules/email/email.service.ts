import { createElement, type ReactElement } from "react";
import { render } from "@react-email/render";

import { OrganizationInvitationEmail } from "@/emails/organization-invitation";
import { getEmailTranslator } from "@/emails/layout";
import { sendRenderedEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { routing, type Locale } from "@/i18n/routing";

export type EmailTemplateMap = {
  "organization-invitation": {
    organizationName: string;
    inviterName: string;
    role: string;
    acceptUrl: string;
    locale?: Locale;
  };
};

type TemplateDefinition<T> = {
  subject: (variables: T) => string;
  component: (props: T) => ReactElement;
};

const templates: { [K in keyof EmailTemplateMap]: TemplateDefinition<EmailTemplateMap[K]> } = {
  "organization-invitation": {
    subject: (variables) =>
      getEmailTranslator(variables.locale ?? routing.defaultLocale)(
        "emails.organizationInvitation.subject",
        { organizationName: variables.organizationName }
      ),
    component: OrganizationInvitationEmail
  }
};

export async function sendEmail<T extends keyof EmailTemplateMap>(args: {
  to: string;
  template: T;
  variables: EmailTemplateMap[T];
}): Promise<{ id: string } | null> {
  const definition = templates[args.template];
  const element = createElement(definition.component, args.variables);

  try {
    const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);

    const result = await sendRenderedEmail({
      to: args.to,
      from: env.EMAIL_FROM,
      subject: definition.subject(args.variables),
      html,
      text
    });

    logger.info("email.sent", { template: args.template, to: args.to, id: result.id });
    return result;
  } catch (error) {
    logger.error("email.send_failed", {
      template: args.template,
      to: args.to,
      errorMessage: error instanceof Error ? error.message : "Unknown error"
    });
    return null;
  }
}
