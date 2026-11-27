import type { Metadata } from "next";
import { Inter } from "next/font/google";
import WalletContextProvider from "./WalletContextProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ÇOMÜ Kampüs Rozet & Ödül Sistemi",
  description: "Solana cNFT Tabanlı Etkinlik Katılım ve Sponsorluk Platformu",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body className={inter.className}>
        <WalletContextProvider>{children}</WalletContextProvider>
      </body>
    </html>
  );
}