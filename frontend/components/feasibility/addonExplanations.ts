/**
 * Static explanations for the calculator cost add-ons in the financial sidebar.
 *
 * These power the "Explain" popover. Copy is markdown; the popover renders it with
 * ReactMarkdown. Any key without an entry falls back to the placeholder.
 */

const PLACEHOLDER = '[INSERT EXPLANATION HERE]';

const SLOPE_EXPLANATION = `### Slope and Retaining Wall Work for Your ADU

**What is Slope / Retaining Wall Work?**

- This type of work involves managing construction on properties with significant changes in elevation.
- Building on a sloped lot can present challenges such as excavation complexities, grading restrictions, drainage issues, and foundational requirements.
- Retaining walls are structures built to hold back soil and create level areas on sloped terrain, making them essential for constructing an ADU on such sites.
- The cost for this work can be very significant and should be taken into account.

**Why is it Needed?**

- If your property has noticeable slopes, retaining walls may be necessary to create a stable and level foundation for your ADU.
- This ensures proper drainage and structural integrity for the new addition.

**Calculator Cost Estimates**

- Slope and retaining wall work is a complication that the calculator can estimate.
- The calculator's estimate for this work is an additional **$10,000 to $35,000**.
- This range is intended to cover potential grading, foundation, access, or retaining wall work when sloped-site conditions apply.
`;

const DEMOLITION_EXPLANATION = `### Demolition or Structure Removal for Your ADU Project

**What is Demolition or Structure Removal?**

- Demolition or structure removal is the process of taking down existing buildings or parts of buildings on your property.
- This can include removing structures like old garages, carports, or accessory sheds.

**Why Might You Need Demolition?**

- Demolition may be a required step if an existing structure is situated where you plan to build your new detached ADU.
- Site preparation, which can include demolition, grading, or tree removal, is a necessary part of preparing your land for construction.
- The complexity of the site and the type of structure being removed can influence the overall cost.
- Local city requirements, such as the mandatory recycling of demolition waste, can also contribute to the cost.

**Estimated Costs for Demolition**

- The calculator supports estimating costs for demolition or structure removal.
- The estimated cost range provided by the calculator for demolition or structure removal is **$1,000 – $10,000**.
`;

const SOLAR_MANDATE_EXPLANATION = `### Solar Mandate for Your ADU Project

**What is the Solar Mandate?**

- Newly constructed Accessory Dwelling Units (ADUs) in California are subject to energy code requirements that mandate the installation of solar panels (Title 24).
- These regulations are in place to ensure new constructions meet energy efficiency standards.

**Why is Solar Required for Your ADU?**

- Your ADU, as a newly constructed, non-manufactured unit, falls under these energy code mandates.
- This solar requirement is automatically included in your project's estimate because it is a detached ADU in California.
- While some smaller ADUs (under 620 square feet) may be exempt from solar requirements, and there is a potential exemption if the PV capacity on Title 24 is below 1.8 kWdc, your ADU requires solar to comply.

**Estimated Costs for the Solar Mandate**

- The calculator estimates the cost for the solar mandate.
- The estimated cost range provided by the calculator for the solar mandate is **$7,000 – $12,000**.
`;

const VERY_HIGH_FIRE_RISK_EXPLANATION = `### Very High Fire Risk Compliance for Your ADU Project

**What is Very High Fire Risk Compliance?**

- It refers to specific building standards and practices designed to protect structures from wildfire ignition in the most severe hazard areas.
- These requirements involve using fire-resistant materials for exterior construction and managing defensible space around the property.
- California's Chapter 7A of the building code sets minimum standards for new constructions in Wildland-Urban Interface areas.
- The goal is to resist wind-driven embers, radiant heat, and direct flames during a wildfire.

**Why Do You Need to Factor It In?**

- Your property is located in a Very High fire hazard severity zone.
- Properties in designated Very High fire hazard zones require specific building considerations to mitigate risks.
- This designation automatically triggers stronger wildfire-compliance requirements.
- Compliance ensures your ADU is built to withstand potential wildfire threats, protecting both the structure and its occupants.
- The requirements typically include meeting Chapter 7A material standards for exterior components like walls and roofs.

**Estimated Costs**

- The calculator supports estimating costs for Very High fire risk compliance.
- This requirement is currently factored into your project's financial estimate when it applies.
- The estimated additional cost range provided by the calculator for Very High fire risk compliance is **$10,000 – $17,500**.
`;

const FIRE_RESILIENT_UPGRADES_EXPLANATION = `### Fire-Resilient Materials and Safety Upgrades for Your ADU

**What are Fire-Resilient Materials and Safety Upgrades?**

- Fire-resilient materials are construction components designed to resist flames and embers.
- These materials enhance a building's safety in wildfire-prone areas.
- Examples include concrete, brick, and fiber cement or stucco siding.
- Other materials can include fire-rated caulks and sealants.
- Additional fire-resistant elements can involve Class A fire-rated roofing materials.
- These may also include dual-pane tempered glass.
- Flame- and ember-resistant vents are also key features.
- Safety upgrades may also encompass creating defensible space, such as a 10-foot ember-resistant zone around the structure.

**Why Are They Important?**

- California homes are frequently exposed to wildfire risks, making fire-resistant construction a critical consideration for protection.
- This is vital for long-term safety and property protection.
- Implementing wildfire-resistant building practices can lead to greater long-term benefits, despite potentially increasing initial construction costs.
- Utilizing non-combustible materials can contribute to faster construction timelines and offer significant safety advantages.
- Home hardening and creating clear zones around structures are recognized strategies for mitigating wildfire damage.

**Estimated Costs from the Calculator**

- The calculator has factored in the cost of fire-resilient materials and safety upgrades for your ADU project, as your property is located in either an unknown or a moderate/high fire hazard zone.
- This allowance is currently estimated to be in the range of **$5,000 – $10,000**.
- This estimate covers the cost of these specific fire-resilient materials and potential sprinkler-related upgrades.
`;

const ELECTRIC_PANEL_EXPLANATION = `### Electrical Panel Upgrades for Your ADU

**What is an Electrical Panel Upgrade?**

- The electrical panel, often called a breaker box or service panel, serves as the central hub that distributes electricity from your utility meter to all the different circuits in your home.
- It houses the circuit breakers or fuses that protect your home's wiring from electrical overloads and short circuits, preventing potential hazards.
- An electrical panel upgrade typically involves replacing an older, smaller, or outdated panel with a newer, higher-capacity unit.

**Why You May Need an Electrical Panel Upgrade for Your ADU**

- Adding an Accessory Dwelling Unit (ADU) significantly increases the electrical demand on your property's existing electrical system.
- To safely manage this additional load and comply with local building codes, your current electrical panel may need to be upgraded to accommodate the new circuits required for the ADU.
- ADUs in California commonly require a minimum **200-amp** panel to support the additional electrical needs.
- The most direct way to determine if an upgrade is necessary is to consult with a qualified electrician. They can assess your current electrical panel's capacity and the ADU's anticipated power load.
- Key factors to consider include whether the ADU will be fully electric and the types of appliances it will use.

**Calculator Estimate for Electrical Panel Upgrades**

- The calculator supports estimating the cost of an electrical panel upgrade as a potential addition to your project.
- If you decide to proceed with an electrical panel upgrade, the estimated cost falls between **$3,500 and $7,000**.
`;

const CONTINGENCY_EXPLANATION = `### Construction Contingency for Your ADU Project

**What is Construction Contingency?**

- Construction contingency refers to a designated amount of money within a construction budget that you can use to pay for unexpected costs that may occur.
- It is a reserve set aside to cover unanticipated costs that may arise during a project.
- This reserve is a predetermined amount or percentage of the contract held for unpredictable changes in the project.
- Contingency is designed to cover the small, necessary unknowns that arise naturally in any project.
- It allows for items, conditions, or events for which the state, occurrence, and/or effect are uncertain.

**Why You Need to Account for It**

- A contingency serves as a helpful risk management tool.
- It is critical for managing unpredictable changes in the project.
- It helps protect your ADU project from unexpected construction costs.
- Having contingency funds ensures you can address unforeseen conditions or necessary adjustments without derailing the project.

**Calculator Estimate for Contingency**

- Your current ADU estimate from the calculator includes construction contingency when a base estimate is available.
- The calculator adds **10%** to the estimated cost for unforeseen conditions.
- This 10% is automatically included as a standard measure for managing unpredictable construction factors.
`;

const SEPTIC_TANK_EXPLANATION = `### Understanding Septic Tank Work for Your ADU

**What is Septic Tank Work?**

- Septic tank work involves the installation or modification of a system designed to manage wastewater for properties not connected to a public sewer.
- A typical septic system includes a watertight tank that separates solid waste from liquid effluent, followed by a leach field for dispersing the treated water into the soil.
- Septic tanks must be constructed from durable materials and be watertight to prevent leaks and protect groundwater.

**Why You Might Need Septic Tank Work for Your ADU**

- If your property is not connected to a municipal sewer system, an Accessory Dwelling Unit (ADU) generally requires its own septic system.
- In many California jurisdictions, ADUs must be served by a separate septic tank, distinct from the main house's system, to handle their specific wastewater needs.
- Regulations typically mandate that the leach field for an ADU is sized to accommodate a minimum of 2 bedrooms.
- Septic tank capacity requirements vary by the number of bedrooms; for example, a minimum of 750 gallons may be required for a 1–2 bedroom dwelling, while a 1,500-gallon minimum might apply to a 1-bedroom ADU.
- Properties situated on marginal soils may necessitate larger leach field areas, potentially exceeding 20,000 square feet, particularly for larger ADUs with multiple bedrooms.

**How to Check if Septic Work is Needed**

- The primary determination for needing septic work is whether your property is connected to a public sewer system.
- If your property relies on an existing septic system, it is crucial to confirm if that system has the capacity to support the additional wastewater generated by the ADU.
- Local building departments and environmental health agencies are the authorities responsible for specifying the exact septic system requirements for your ADU project.

**Estimated Costs for Septic Tank Work**

- Septic tank work is a complication supported by the calculator.
- The calculator estimates the cost for septic tank work to be between **$5,000 and $20,000**.
`;

const HOA_RESTRICTIONS_EXPLANATION = `### HOA-Driven Design Costs for Your ADU Project

**What are HOA-Driven Design Costs?**

- HOA-driven design costs are expenses associated with complying with specific architectural, design, or aesthetic guidelines that your Homeowners Association (HOA) may require for your Accessory Dwelling Unit (ADU).
- These can include restrictions on exterior materials, colors, rooflines, height, or overall architectural style.

**Why Consider HOA Restrictions?**

- While California law generally prevents HOAs from prohibiting the construction of an ADU that meets state regulations, they can still impose reasonable restrictions on exterior design, height, and other aesthetic elements.
- These restrictions aim to ensure the ADU complements the existing neighborhood aesthetic.
- State laws, such as AB 670, invalidate HOA rules that prohibit ADUs.

**How to Check if This Applies**

- Although California law limits HOA prohibitions, it's always advisable to check your specific HOA's covenants, conditions, and restrictions (CC&Rs) or consult directly with your HOA board to understand any applicable design guidelines.

**Estimated Costs for HOA Design Requirements**

- The calculator supports estimating costs for HOA-driven design requirements.
- When this complication applies, the estimate uses a range of **$15 to $35 per square foot** of ADU floor area.
`;

const ADDON_EXPLANATIONS: Record<string, string> = {
  slope: SLOPE_EXPLANATION,
  demolition: DEMOLITION_EXPLANATION,
  electric_panel: ELECTRIC_PANEL_EXPLANATION,
  septic_tank: SEPTIC_TANK_EXPLANATION,
  solar_mandate: SOLAR_MANDATE_EXPLANATION,
  hoa_restrictions: HOA_RESTRICTIONS_EXPLANATION,
  very_high_fire_risk: VERY_HIGH_FIRE_RISK_EXPLANATION,
  fire_resilient_upgrades: FIRE_RESILIENT_UPGRADES_EXPLANATION,
  high_fire_risk: VERY_HIGH_FIRE_RISK_EXPLANATION,
  contingency: CONTINGENCY_EXPLANATION,
};

/** Prefer canonical labels for known keys so UI stays correct if the API serves stale copy. */
export function getAddonDisplayLabel(key: string, apiLabel: string): string {
  if (key === 'very_high_fire_risk' || key === 'high_fire_risk') {
    return 'Very High fire risk compliance';
  }
  return apiLabel;
}

export function getAddonExplanation(key: string): string {
  return ADDON_EXPLANATIONS[key] ?? PLACEHOLDER;
}
