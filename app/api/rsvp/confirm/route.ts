import { apiError, body, json, requireUser, uuid } from "@/lib/api";
import { submitDeposit } from "@/lib/deposits";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await requireUser("student");
    const input = await body(request);
    const result = await submitDeposit(user.id, uuid(input.deposit_id), input.signed_transaction);
    const response = json({ success: result.deposit.state === "confirmed", processing: result.status === 202, deposit: result.deposit }, result.status);
    if (result.status === 202) response.headers.set("Retry-After", "3");
    return response;
  } catch (error) { return apiError(error); }
}
