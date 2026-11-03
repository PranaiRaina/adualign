'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

type FaqItem = {
  question: string;
  answer: string;
};

const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'What is an ADU, and does my property qualify for one?',
    answer:
      'An ADU (Accessory Dwelling Unit) is a second, self-contained home on the same lot as your main house. We check the two most common types: a detached ADU, which is a standalone unit like a backyard cottage, and an attached ADU, which is an addition built onto your main house. California law makes most single-family and multi-family lots eligible, but whether yours works comes down to your lot size, setbacks, and local zoning. Type in your address and we’ll tell you where you stand.',
  },
  {
    question: 'How accurate is the feasibility verdict?',
    answer:
      'Your lot boundaries come straight from official government parcel records, and building footprints come from dedicated external mapping providers. We run that data against California HCD code to calculate your buildable area and max ADU size, so the verdict is as accurate as the records behind it. That is reliable enough to know whether an ADU makes sense before you spend money on a designer. Just keep in mind the final call always comes from your local jurisdiction, so think of it as a solid pre-check rather than a permit, and confirm the details on site and with your city before you commit to a build.',
  },
  {
    question: 'Which cities and counties do you cover?',
    answer:
      'We work across California. State ADU law sets the baseline everywhere, and we add local zoning and setback data wherever we have it. The quickest way to know exactly what applies to you is to punch in your address and look at the results for your parcel.',
  },
  {
    question: 'How does the cost estimate work?',
    answer:
      'You get a live construction cost estimate based on your ADU’s size and type. Toggle the things that make a build harder, like a sloped lot, electric panel upgrades, or demolition work, and the number moves in real time. It’s an easy way to see what actually drives your budget before you commit to anything.',
  },
  {
    question: 'Is the ADU Advisor just generic AI, or does it know my property?',
    answer:
      'It knows the ADU you designed. When you place an ADU on your lot, the Advisor sees its size, its shape, the yard zone it sits in, and its clearances from your home and other structures. So when you ask a permit or zoning question, the answer is grounded in the latest HCD ADU Handbook and/or live web search, applied to your specific placement, so you get the most relevant and up-to-date guidance.',
  },
  {
    question: 'Do you handle permits or construction?',
    answer:
      'No, we’re a planning and feasibility tool, not a contractor or permit expediter. What we do is help you figure out what’s possible, estimate the cost, and put together a report with a summary, zoning analysis, and the numbers. Think of it as the kickstart to your ADU journey, so you walk into conversations with designers, builders, and your permit office already knowing where you stand.',
  },
  {
    question: 'Is my address and property data kept private?',
    answer:
      'Yes. We only use your address to run your feasibility analysis and build your report. Your projects stay tied to your account, and we don’t sell your data. You can read the details anytime in our Privacy Policy.',
  },
];

function FaqRow({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="py-2">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="group flex w-full items-start justify-between gap-6 py-4 text-left"
      >
        <span className="text-base font-semibold text-surface-900">{item.question}</span>
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-surface-200 bg-surface-0 text-surface-500 transition-all group-hover:border-brand-300 group-hover:text-brand-600 ${
            open ? 'rotate-45' : ''
          }`}
        >
          <Plus className="h-4 w-4" />
        </span>
      </button>
      <div
        className={`grid transition-all duration-300 ease-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <p className="max-w-2xl pb-4 pr-12 text-sm leading-relaxed text-surface-500">
            {item.answer}
          </p>
        </div>
      </div>
    </div>
  );
}

export function FaqSection() {
  return (
    <section id="faq" className="bg-surface-0 py-20 px-6">
      <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-600">FAQ</p>
          <h2 className="text-3xl font-bold tracking-tight text-surface-900 md:text-4xl">
            Questions, answered
          </h2>
          <p className="mt-4 max-w-xs text-base leading-relaxed text-surface-500">
            Everything you need to know about checking your lot and planning your ADU. Still stuck?{' '}
            <a href="/contact" className="font-medium text-brand-600 hover:text-brand-700">
              Get in touch
            </a>
            .
          </p>
        </div>

        <div className="divide-y divide-surface-200">
          {FAQ_ITEMS.map((item) => (
            <FaqRow key={item.question} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}
