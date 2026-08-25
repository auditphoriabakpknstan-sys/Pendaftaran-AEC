import type { ReactNode } from "react"
import "./globals.css"

export const metadata = {
  title: "Formulir Pendaftaran Lomba — Auditphoria 6.0",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  )
}
