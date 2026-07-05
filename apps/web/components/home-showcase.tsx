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
        <CardTitle className="text-h1">Branch out</CardTitle>
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
        </div>
        {/* Accent is a fill color, not a Badge variant - show it as its own labeled swatch so it
            doesn't masquerade as a peer of the Badges above. */}
        <div className="flex items-center gap-2 text-body-sm text-text-muted">
          <span>Accent</span>
          <span className="inline-flex items-center rounded-md bg-accent px-2 py-1 font-medium text-accent-foreground">
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
