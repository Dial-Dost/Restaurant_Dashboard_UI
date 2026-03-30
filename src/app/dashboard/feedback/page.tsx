"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getFeedbackEntries, getFeedbackSummary, type FeedbackEntry, type FeedbackSummary } from "@/lib/db";
import { useAuth } from "@/context/AuthContext";

function formatDate(input?: string | null): string {
  if (!input) {
    return "Unknown";
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString();
}

export default function FeedbackPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!user?.restaurantId) {
        setLoading(false);
        return;
      }

      try {
        const [feedbackRows, feedbackSummary] = await Promise.all([
          getFeedbackEntries(user.restaurantId, 100),
          getFeedbackSummary(user.restaurantId),
        ]);

        if (!active) {
          return;
        }

        setEntries(feedbackRows);
        setSummary(feedbackSummary);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      active = false;
    };
  }, [user?.restaurantId]);

  const categoryRows = useMemo(() => {
    if (!summary) {
      return [];
    }
    return Object.entries(summary.categoryAverages).sort((a, b) => {
      const av = a[1].average ?? 0;
      const bv = b[1].average ?? 0;
      return bv - av;
    });
  }, [summary]);

  return (
    <div className="grid gap-4 md:gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Feedback</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Responses</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary?.totalResponses ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Average Rating</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {summary?.averageRating !== null && summary?.averageRating !== undefined
                ? `${summary.averageRating}/5`
                : "N/A"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Last 30 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary?.last30DaysResponses ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Category Averages</CardTitle>
          <CardDescription>Average scores for each service category</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {categoryRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No category ratings yet.</p>
          ) : (
            categoryRows.map(([key, value]) => (
              <div className="rounded-md border p-3" key={key}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{value.label}</p>
                  <Badge variant="secondary">{value.average !== null ? `${value.average}/5` : "N/A"}</Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latest Feedback</CardTitle>
          <CardDescription>Most recent customer submissions</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading feedback...</p> : null}
          {!loading && entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No feedback submissions yet.</p>
          ) : null}
          {entries.map((entry) => (
            <article className="rounded-md border p-3" key={entry.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{entry.customer_name || "Anonymous"}</p>
                <div className="flex items-center gap-2">
                  <Badge>{entry.overall_rating ? `${entry.overall_rating}/5` : "No score"}</Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(entry.submitted_at)}</span>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {entry.comments?.trim() ? entry.comments : "No additional comments."}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {entry.category_ratings.slice(0, 6).map((category) => (
                  <Badge key={`${entry.id}-${category.key}`} variant="outline">
                    {category.label}: {category.rating}/5
                  </Badge>
                ))}
              </div>
            </article>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
