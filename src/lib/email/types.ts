export type RenderedEmail = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
};

export type EmailSendResult = {
  id: string;
};

export interface EmailProvider {
  send(message: RenderedEmail): Promise<EmailSendResult>;
}
