'use client';

import { Badge, Button, Input } from '@rogueoak/canopy';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@rogueoak/canopy/twigs';
import { ThemeToggle } from './theme-toggle';

// Real canopy components (Button, Card, Badge, Input) rendered in the Confetti brand with NO
// per-component style overrides - all color comes from the token layer (spec 0002). Canopy ships
// its components without a `use client` directive, so this file establishes the client boundary
// the App Router needs (canopy's Card uses React context).
export function HomeShowcase() {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-4xl font-bold tracking-tight">Branch out</CardTitle>
        <CardDescription>where game night grows.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Start a room</Button>
          <Button variant="secondary">Invite friends</Button>
          <Button variant="outline">Browse games</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="primary">Grape</Badge>
          <Badge variant="success">Ready</Badge>
          <Badge variant="warning">Waiting</Badge>
          <Badge variant="danger">Full</Badge>
          <Badge variant="info">Beta</Badge>
          <span className="rounded-md bg-accent px-2 py-1 text-sm font-medium text-accent-foreground">
            Confetti
          </span>
        </div>
        <Input placeholder="Room code" aria-label="Room code" />
      </CardContent>
      <CardFooter>
        <ThemeToggle />
      </CardFooter>
    </Card>
  );
}
