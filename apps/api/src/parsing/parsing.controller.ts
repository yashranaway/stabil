import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { extractPdfText } from "./pdf-text";
import { ParsingService } from "./parsing.service";

const parseResumeSchema = z.object({
  resumeText: z.string().min(20).max(50_000),
});

/** Shape of the file Multer attaches to the request — kept local to avoid an
 * @types/express-wide dependency (see ProblemFilter for the same pattern). */
interface UploadedPdf {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

const MAX_PDF_BYTES = 8 * 1024 * 1024;

@Controller("api/v1/parse")
@UseGuards(JwtAuthGuard)
export class ParsingController {
  constructor(private readonly parsing: ParsingService) {}

  @Post("resume")
  parseResume(@Body() body: unknown) {
    const parsed = parseResumeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.parsing.parseResume(parsed.data.resumeText);
  }

  /** Same pipeline as /resume, but the résumé arrives as an uploaded PDF file. */
  @Post("resume-file")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_PDF_BYTES } }))
  async parseResumeFile(@UploadedFile() file: UploadedPdf | undefined) {
    if (!file) {
      throw new BadRequestException("No file uploaded (expected field name 'file').");
    }
    if (file.mimetype !== "application/pdf") {
      throw new BadRequestException("Only PDF files are supported.");
    }

    let text: string;
    try {
      text = await extractPdfText(file.buffer);
    } catch {
      throw new BadRequestException("Could not read this PDF — it may be scanned or corrupted.");
    }
    if (text.trim().length < 20) {
      throw new BadRequestException(
        "Not enough extractable text in this PDF (scanned/image-only PDFs aren't supported yet).",
      );
    }

    return this.parsing.parseResume(text);
  }
}
