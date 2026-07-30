import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
