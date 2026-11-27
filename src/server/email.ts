import 'server-only';
import { Resend } from 'resend';
import { env } from './env';
import type { EmailSender } from '@/agent/capabilities/execution';

export class ResendSender implements EmailSender {
  private client: Resend;
  constructor(key: string, private readonly from: string) { this.client = new Resend(key); }
  async send(m: { to: string; subject: string; html: string; text: string; idempotencyKey: string }) {
    const { data, error } = await this.client.emails.send({ from: this.from, to: m.to, subject: m.subject, html: m.html, text: m.text }, { idempotencyKey: m.idempotencyKey });
    if (error || !data) throw new Error(error?.message ?? 'Resend returned no id');
    return { id: data.id };
  }
}
export const emailSender = (): EmailSender | undefined => (env.resendKey && env.emailFrom ? new ResendSender(env.resendKey, env.emailFrom) : undefined);
