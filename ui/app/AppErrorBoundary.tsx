import React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type AppErrorBoundaryState = {
  error?: Error;
};

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="grid h-screen place-items-center bg-background p-6 text-foreground">
        <Card className="w-full max-w-lg border-destructive/25 bg-card shadow-none">
          <CardHeader className="px-5 py-4">
            <h1 className="text-lg font-semibold">The review inbox stopped rendering</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              The desktop shell is still running. Reload the app after the current fix lands.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 pt-0">
            <pre className="max-h-44 overflow-auto rounded-md border bg-background p-3 text-xs text-destructive">
              {this.state.error.message}
            </pre>
            <Button
              type="button"
              className="w-fit bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => window.location.reload()}
            >
              Reload app
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }
}
