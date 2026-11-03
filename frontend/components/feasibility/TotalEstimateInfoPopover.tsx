'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AddonExplanationPopover } from '@/components/feasibility/AddonExplanationPopover';

const CITATION_RE = /(\[\d+\])/g;

const CITATION_URLS = [
  'https://andalusiadrafting.com/blog/california-adu-cost-guide',
  'https://www.kellowconstruction.com/blog/how-much-does-it-cost-to-build-an-adu-in-california',
  'https://imkatconstruction.com/detached-vs-attached-adu-cost-comparison/',
  'https://bfpminc.com/how-much-does-it-really-cost-to-build-an-adu-in-california/',
  'https://www.bestplaces.net/',
  'https://www.abodu.com/blog/backyard-living/adu-cost-california-2026',
  'https://www.safewayremodel.com/blog/adu-cost-woodland-hills-2026',
  'https://www.typefive.com/feed/adu-cost-and-financing',
  'https://www.alphastructural.com/foundation-repair/retaining-walls-ventura/',
  'https://snapadu.com/blog/how-to-lower-adu-costs/',
  'https://www.homedepot.com/c/ab/costs-to-demolish-a-house/9ba683603be9fa5395fab901dfd3fa60',
  'https://asapelectric209.com/blog/electrical-panel-upgrade-cost-california/',
  'https://tradesmanelectric.com/electrical-panel-replacement-cost-guide-2024-2025/',
  'https://www.homedepot.com/c/ab/costs-to-demolish-a-house/9ba683603be9fa5395fab901dfd3fa60',
  'https://www.nerdwallet.com/home-ownership/home-improvement/learn/septic-tank-cost',
  'https://betterplacedesignbuild.com/blog/adu-cost-breakdown/',
  'https://www.buildinganadu.com/cost-of-building-an-adu',
];

const TOTAL_ESTIMATE_EXPLANATION = `## Understanding the Calculator

### How We Estimate Your Base Cost

Our calculator prices your unit with **tiered, marginal rates**, so each rate applies only to the square footage that falls inside its band. For detached ADUs, the first 400 sqft is priced at **$350/sqft**, square footage from 400 to 750 sqft at **$265/sqft**, and anything above 750 sqft at **$200/sqft**. Attached ADUs follow the same bands at **$300, $225, and $165 per sqft**. These rates are consistent with current California ADU construction data [1][2][17]. Attached ADUs cost less because they share structural elements with the primary residence, reducing foundation, framing, and exterior envelope work. On average they are **15-25% cheaper** than detached ADUs, which is reflected in the rates [3].

The rates step down as size grows because of **economies of scale**: fixed costs like mobilization, permitting, design, and utility connections are spread across more floor area, so larger units cost less per square foot while smaller units carry a higher effective rate [4][17]. For the same reason, every estimate includes a **minimum project cost of $140,000 for detached and $122,500 for attached ADUs** — below roughly 400 sqft, shrinking the unit does not meaningfully shrink the budget, because those fixed costs dominate small projects [17].

These rates cover the full scope of a standard build, covering most hard costs like site work, foundation, framing, mechanical, electrical, and plumbing, as well as most soft costs like architectural drawings, structural engineering, basic permits, and utility connections [4].

**Your location is factored in automatically.** Construction costs vary significantly across California, driven by differences in labor markets and subcontractor availability. Bay Area counties carry a higher multiplier than Greater LA, which in turn costs more than Inland Empire counties like Riverside and San Bernardino, which is a pattern consistent with regional cost of living and construction cost data [2][5]. The location multiplier applies to your whole base cost, including the minimum project cost.

Your result is shown as a **cost range rather than a single number**, reflecting the real variation in subcontractor pricing, materials, and site conditions that any contractor would quote before a site visit.

### Complication add-ons

#### Fire Hazard Zone Compliance

Properties in designated fire hazard zones face additional building requirements that meaningfully affect cost, and these are applied automatically based on your property's fire zone classification.

**Moderate and High Fire Hazard Zones** require fire-resilient construction materials and, in many cases, sprinkler system upgrades to meet current California building code. These requirements typically add **$5,000-$10,000** to a project [6].

**Very High Fire Hazard Severity Zones (VHFHSZ)** carry stricter requirements under Chapter 7A of the California Building Code, including ignition-resistant materials for exterior walls, soffits, decking, and vents, as well as 2026 Zone Zero defensible space compliance. These add **$10,000-$17,500** to construction costs [7].

Our estimates include a slight uplift above raw material costs to account for associated permitting and unforeseen compliance items that commonly arise on fire zone builds.

#### Construction Contingency

Every ADU budget should account for unforeseen conditions that surface once construction begins. Unexpected site conditions, minor design changes, material lead times, and permit revisions are common enough that experienced contractors and financial advisors consistently recommend setting aside a contingency buffer. Industry guidance typically puts this at **10-20% of total project cost** [1][8].

Our calculator automatically applies a **10% contingency** on top of your subtotal. This reflects the lower end of that range, appropriate for a rough estimate, and helps ensure your budget is not caught off guard by the kind of minor complications that arise on nearly every build.

#### Slope and Retaining Wall Work

Sloped lots introduce site preparation costs that flat lots simply don't have. Depending on the degree of slope, grading, engineered retaining walls, and additional foundation work may be required before construction can begin. This is one of the more variable complications in ADU construction because costs scale significantly with how steep the site is, soil conditions, and how much of the slope falls within the ADU footprint.

Retaining wall costs alone can range from a few thousand dollars for a small landscape wall to tens of thousands for a structural wall requiring caissons and drainage work [9]. On ADU builds specifically, retaining walls commonly add **$20,000 to $30,000** on top of standard construction costs [10].

Given that inherent variability, we selected a range of **$10,000 to $35,000** that reflects the most common scenarios for residential ADU builds. Minor grading on a gently sloped lot lands near the low end, while significant retaining wall construction on a steep site approaches the high end. Severe slope conditions can exceed this range and would warrant a dedicated site assessment before budgeting.

#### Demolition or Structure Removal

If your ADU site has an existing structure that needs to be cleared, whether a shed, garage, or other outbuilding, demolition costs need to be factored in before construction can begin. Demolition costs nationally range from **$3,000 to $25,000** depending on structure size, site access, equipment required, and local permit and inspection fees [14].

For the smaller-scale removals typical of ADU site prep, we use a range of **$1,000 to $10,000**. A simple shed or small structure removal with easy access lands near the low end, while a larger detached garage or structure in a constrained site with debris hauling and permit requirements approaches the high end.

#### Electrical Panel Upgrade

Adding an ADU often requires upgrading the main home's electrical panel to handle the additional load. In California, panel upgrades typically run **$4,000 to $6,000** for a standard 200-amp upgrade, with permits and inspections adding another **$500 to $2,000** [12][13].

Our estimate uses a range of **$3,500 to $7,000**, reflecting that ADU-related panel work is often less involved than a full residential panel replacement, but still carries meaningful cost depending on your current panel capacity, the distance from the panel to the ADU, and local permit requirements.

#### Septic Tank Work

Properties not connected to a municipal sewer line require a septic system, and adding an ADU means that system needs to be evaluated and often expanded or upgraded to handle the additional load. Full septic system costs vary significantly depending on system type, soil conditions, and what the county requires. Anaerobic systems run **$3,000 to $8,000**, aerobic systems **$10,000 to $20,000**, and alternative systems for properties where traditional setups won't work can reach **$20,000**. Additional line items like percolation testing, permits, and leach field installation add further cost [15].

Our range of **$5,000 to $20,000** captures the most common scope of work for ADU-related septic upgrades, from minor system modifications at the low end to full system upgrades.

#### HOA-Driven Design Costs

Homeowners in HOA communities face an additional layer of design requirements on top of standard building code. HOAs can mandate specific exterior materials, rooflines, color palettes, and architectural styles to maintain neighborhood cohesion, all of which add cost compared to a standard build [10][16].

Unlike other complications with well-documented cost ranges, HOA design premiums vary widely depending on the strictness of the HOA's architectural guidelines and how much deviation is required from a standard design. Our estimate of **$15 to $35 per square foot** is extrapolated from the broader premium that custom architectural requirements add to ADU construction costs, and is intended as a reasonable planning figure rather than a precise quote. The actual impact depends on your HOA's specific requirements and is best confirmed with your HOA's architectural review committee before breaking ground.
`;

const TOTAL_ESTIMATE_PROSE_CLASS =
  'px-6 py-5 pr-10 text-[14px] leading-7 text-surface-700 ' +
  '[&_h2]:mb-5 [&_h2]:mt-0 [&_h2]:text-[22px] [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:text-surface-950 ' +
  '[&_h3]:mb-3 [&_h3]:mt-8 [&_h3]:text-[18px] [&_h3]:font-semibold [&_h3]:leading-tight [&_h3]:text-surface-950 [&_h3:first-child]:mt-0 ' +
  '[&_h4]:mb-3 [&_h4]:mt-8 [&_h4]:text-[16px] [&_h4]:font-semibold [&_h4]:leading-snug [&_h4]:text-surface-950 ' +
  '[&_p]:my-4 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_strong]:text-surface-950';

function injectCitationLinks(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(CITATION_RE).map((part, index) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (!match) return part;

    const citationNumber = Number.parseInt(match[1], 10);
    const url = CITATION_URLS[citationNumber - 1];
    if (!url) return <span key={`${keyPrefix}-${index}`}>{part}</span>;

    return (
      <sup key={`${keyPrefix}-${index}`}>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={`Source ${citationNumber}`}
          className="inline-flex min-w-[1.1em] items-center justify-center rounded px-0.5 font-mono text-[10px] font-bold leading-none text-brand-600 transition-colors duration-150 hover:bg-brand-50 hover:text-brand-700"
        >
          {citationNumber}
        </a>
      </sup>
    );
  });
}

function renderCitedChildren(children: React.ReactNode, keyPrefix = 'c'): React.ReactNode {
  return React.Children.map(children, (child, index) => {
    if (typeof child === 'string') {
      return injectCitationLinks(child, `${keyPrefix}-${index}`);
    }
    if (React.isValidElement(child) && (child.props as any).children) {
      return React.cloneElement(child as React.ReactElement<any>, {
        children: renderCitedChildren((child.props as any).children, `${keyPrefix}-${index}`),
      });
    }
    return child;
  });
}

const markdownComponents = {
  p: ({ children }: any) => <p>{renderCitedChildren(children)}</p>,
  li: ({ children }: any) => <li>{renderCitedChildren(children)}</li>,
  strong: ({ children }: any) => <strong>{renderCitedChildren(children)}</strong>,
  em: ({ children }: any) => <em>{renderCitedChildren(children)}</em>,
};

interface TotalEstimateInfoPopoverProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  triggerRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function TotalEstimateInfoPopover({
  open,
  anchorRef,
  triggerRef,
  onClose,
}: TotalEstimateInfoPopoverProps) {
  return (
    <AddonExplanationPopover
      open={open}
      anchorRef={anchorRef}
      triggerRef={triggerRef}
      label="Total cost estimate"
      explanation=""
      autoFocusCloseButton={false}
      panelClassName="w-[min(560px,calc(100vw-24px))] max-h-[min(78vh,760px)]"
      scrollViewportClassName="max-h-[min(78vh,760px)]"
      onClose={onClose}
    >
      <div className={TOTAL_ESTIMATE_PROSE_CLASS}>
        <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
          {TOTAL_ESTIMATE_EXPLANATION}
        </ReactMarkdown>
      </div>
    </AddonExplanationPopover>
  );
}
