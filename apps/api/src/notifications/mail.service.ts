import { Injectable, Logger } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Sends notification emails. Uses SMTP_URL when configured; otherwise a JSON
 * transport that logs the message (so dev/CI never need a real mail server).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger("MailService");
  private readonly from = process.env.EMAIL_FROM ?? "Stabil <no-reply@stabil.dev>";
  private transport: Transporter | null = null;

  private getTransport(): Transporter {
    if (this.transport) return this.transport;
    const url = process.env.SMTP_URL;
    this.transport = url ? nodemailer.createTransport(url) : nodemailer.createTransport({ jsonTransport: true });
    return this.transport;
  }

  /** Best-effort send — never throws into the calling flow. */
  async send(to: string, subject: string, text: string): Promise<void> {
    try {
      const info = await this.getTransport().sendMail({ from: this.from, to, subject, text });
      if (!process.env.SMTP_URL) {
        this.logger.log(`[dev] email to ${to}: ${subject}`);
      } else {
        this.logger.log(`email sent to ${to} (${info.messageId})`);
      }
    } catch (err) {
      this.logger.error(`failed to email ${to}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
