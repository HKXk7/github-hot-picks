import { NextResponse, type NextRequest } from "next/server";

/**
 * /usage 是内部成本看板，不该对外开放。
 *
 * 两条刻意的选择：
 * 1. 令牌没配就一律拒绝（fail closed）。忘了配 token 的后果应该是「看板打不开」，
 *    而不是「谁都能看」——安全上的默认值必须站在不泄露这边。
 * 2. 不给令牌时返回 404 而不是 401。401 等于告诉外人「这里确实有个东西」，
 *    404 至少不承认它存在。
 */
const COOKIE_NAME = "usage_token";

export default function proxy(req: NextRequest) {
  const expected = process.env.USAGE_PAGE_TOKEN;
  if (!expected) return new NextResponse("Not Found", { status: 404 });

  const fromCookie = req.cookies.get(COOKIE_NAME)?.value ?? "";
  const fromQuery = req.nextUrl.searchParams.get("key") ?? "";
  if (fromCookie !== expected && fromQuery !== expected) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const res = NextResponse.next();
  // 用 ?key= 进来时顺手种上 cookie，之后直接访问就不用每次带参数了
  if (fromQuery === expected) {
    res.cookies.set(COOKIE_NAME, expected, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }
  return res;
}

export const config = {
  matcher: ["/usage", "/usage/"],
};
