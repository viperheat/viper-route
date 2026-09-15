import { NextRequest, NextResponse } from "next/server";
import { getStationTrains } from "@/lib/trains";
import { UnknownStationError } from "@/lib/arrivals";

// Depends on request-time data pulled from live MTA feeds; never prerender.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const stationId = request.nextUrl.searchParams.get("station");

  if (!stationId) {
    return NextResponse.json(
      { error: "Missing required query parameter: station" },
      { status: 400 }
    );
  }

  try {
    const result = await getStationTrains(stationId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnknownStationError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("api/trains: failed to fetch train positions", err);
    return NextResponse.json(
      { error: "Failed to fetch train positions from MTA feeds" },
      { status: 502 }
    );
  }
}
