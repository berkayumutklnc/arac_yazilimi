import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Üretim Docker imajı yalnızca .next/standalone + .next/static + public'i
  // taşır (bkz. docs/adr/0015) — tam node_modules'ü imaja koymaktan çok daha
  // küçük bir runtime katmanı.
  output: "standalone",
  // Next.js "workspace root"u otomatik algılar (en yakın lockfile'a göre) —
  // bu makinede kullanıcı ana dizininde repo DIŞINDA, alakasız bir
  // package-lock.json bulunduğu için yanlış (çok daha yukarıdaki) bir kök
  // seçip standalone çıktısını `.next/standalone/<host-mutlak-yolu>/apps/web/`
  // gibi öngörülemez bir derinliğe gömüyordu (doğrulandı — bkz. build
  // uyarısı). Dockerfile'ın COPY yollarının host'tan bağımsız, deterministik
  // olması için kök burada repo köküne SABİTLENİYOR.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // @arac-yazilim/shared derlenmemiş TS kaynağı olarak workspace'ten
  // symlink'lenir (bkz. packages/shared/package.json) — Next.js varsayılan
  // olarak node_modules'ü transpile etmez, bu yüzden bu paket açıkça eklenmeli.
  transpilePackages: ["@arac-yazilim/shared"],
  webpack(config) {
    // packages/shared, apps/api ile aynı NodeNext kuralına uyar: local
    // importlar ".js" uzantılı ama gerçek dosyalar .ts/.tsx (bkz.
    // tsconfig.base.json "module": "NodeNext"). tsc bunu type-checking'te
    // otomatik eşliyor ama webpack eşlemiyor — bu alias onu telafi ediyor.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
