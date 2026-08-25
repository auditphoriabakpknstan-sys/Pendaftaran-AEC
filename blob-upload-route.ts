import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

// Endpoint ini TIDAK menerima file itu sendiri — cuma mengeluarkan izin
// (token) supaya browser boleh upload LANGSUNG ke Vercel Blob milik project
// ini. Payload-nya selalu kecil, tidak pernah kena limit 4.5MB Vercel Functions.
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
          addRandomSuffix: true,
          maximumSizeInBytes: 10 * 1024 * 1024,
          tokenPayload: JSON.stringify({}),
        }
      },
      onUploadCompleted: async () => {
        // Tidak perlu aksi tambahan — Apps Script yang mengunduh & memindahkan
        // berkas ini ke Drive setelah form disubmit lewat /api/submit.
      },
    })

    return NextResponse.json(jsonResponse)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gagal membuat token upload." },
      { status: 400 },
    )
  }
}
