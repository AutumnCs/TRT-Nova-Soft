import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InfoIcon } from "lucide-react";
import Link from "next/link";

async function UserDetails() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  return JSON.stringify(data.claims, null, 2);
}

export default async function DashboardPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-12">
      <div className="w-full">
        <div className="bg-accent text-sm p-3 px-5 rounded-md text-foreground flex gap-3 items-center">
          <InfoIcon size="16" strokeWidth={2} />
          欢迎来到你的 Dashboard！这是一个受保护的页面，只有已登录用户可以访问。
        </div>
      </div>

      <div className="flex flex-col gap-2 items-start">
        <h1 className="font-bold text-3xl mb-4">Dashboard</h1>
        <p className="text-lg mb-6">登录成功！以下是你的用户信息：</p>
        <pre className="text-xs font-mono p-3 rounded border max-h-40 overflow-auto bg-slate-900 text-slate-100 w-full">
          <UserDetails />
        </pre>
      </div>

      <div className="flex gap-4">
        <Link
          href="/plant-sensors"
          className="inline-block px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
        >
          🌱 植物传感器
        </Link>
        <Link
          href="/books"
          className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          查看 Books 页面
        </Link>
        <Link
          href="/protected"
          className="inline-block px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          查看 Protected 页面
        </Link>
      </div>
    </div>
  );
}
