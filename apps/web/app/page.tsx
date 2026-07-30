"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Kök sayfa doğrudan bir içerik göstermez — /work-orders'a yönlendirir,
// oturum yoksa (protected)/layout.tsx zaten /login'e yönlendirecektir.
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/work-orders");
  }, [router]);

  return null;
}
