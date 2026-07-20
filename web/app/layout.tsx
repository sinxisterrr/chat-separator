import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat Separator",
  description: "Upload your ChatGPT conversations.json and sort threads into 14 AI slots",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
