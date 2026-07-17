import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GameRules } from '../../lib/games/library';
import { RulesContent } from './RulesContent';

const rules: GameRules = {
  objective: 'Score the most points across the rounds.',
  sections: [
    { heading: 'Setup', body: ['The host picks the settings.'] },
    {
      heading: 'On each round',
      body: ['Answer before the timer runs out.', 'No multiple choice.'],
    },
    { heading: 'Scoring', body: ['A correct answer scores 100.'] },
  ],
};

describe('RulesContent', () => {
  it('renders the objective as a lead line', () => {
    render(<RulesContent name="Trivia" rules={rules} />);
    expect(screen.getByText(/score the most points across the rounds/i)).toBeDefined();
  });

  it('renders every section heading', () => {
    render(<RulesContent name="Trivia" rules={rules} />);
    for (const section of rules.sections) {
      expect(screen.getByRole('heading', { name: section.heading })).toBeDefined();
    }
  });

  it('renders each paragraph of a multi-paragraph section', () => {
    render(<RulesContent name="Trivia" rules={rules} />);
    expect(screen.getByText('Answer before the timer runs out.')).toBeDefined();
    expect(screen.getByText('No multiple choice.')).toBeDefined();
  });

  it('renders the quick-start strip only when howToPlay is given', () => {
    const { rerender } = render(<RulesContent name="Trivia" rules={rules} />);
    expect(screen.queryByRole('heading', { name: /quick start/i })).toBeNull();

    rerender(
      <RulesContent
        name="Trivia"
        rules={rules}
        howToPlay={[{ title: 'Start a room', body: 'Share the code.' }]}
      />,
    );
    expect(screen.getByRole('heading', { name: /quick start/i })).toBeDefined();
    expect(screen.getByText('Start a room')).toBeDefined();
  });
});
