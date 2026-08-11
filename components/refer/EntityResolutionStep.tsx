"use client";

import { useState } from "react";
import { referral } from "@/lib/referral";
import { TitledPanel, PropertyRow, FieldLabel } from "./ConsoleChrome";

const OBJECT_TYPES = ["Human", "Vessel", "Shipping Container", "Aircraft"] as const;

type ObjectType = (typeof OBJECT_TYPES)[number];

export default function EntityResolutionStep({
  acknowledged,
  onAcknowledgedChange,
}: {
  acknowledged: boolean;
  onAcknowledgedChange: (next: boolean) => void;
}) {
  const [objectType, setObjectType] = useState<ObjectType>("Human");
  const { candidate } = referral;

  return (
    <TitledPanel title={`Object · ${candidate}`} aside="Draft">
      <div className="mb-6">
        <FieldLabel>Object Type</FieldLabel>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {OBJECT_TYPES.map((type) => (
            <label
              key={type}
              className="flex cursor-pointer items-center gap-2 text-sm text-console-bright"
            >
              <input
                type="radio"
                name="object-type"
                value={type}
                checked={objectType === type}
                onChange={() => setObjectType(type)}
                className="accent-console-amber"
              />
              {type}
            </label>
          ))}
        </div>
        {objectType !== "Human" ? (
          <p className="mt-3 text-xs text-console-amber">
            Reclassified. The pipeline will proceed regardless — this ontology
            has processed stranger things than a {objectType.toLowerCase()}.
          </p>
        ) : null}
      </div>

      <div className="border-t border-console-line pt-2">
        <PropertyRow label="Object ID" value="obj.person.aaron-lin" />
        <PropertyRow
          label="Jurisdiction"
          value="San Francisco Bay Area (self-reported)"
        />
        <PropertyRow label="Threat Level" value="LOW — uses Bun, never npm" />
        <PropertyRow label="Match Confidence" value="0.94" accent />
        <PropertyRow label="Last Seen" value="refreshing this page" />
        <PropertyRow
          label="Linked Objects"
          value="1 résumé · 3 side projects · 0 finished side projects"
        />
        <PropertyRow
          label="Classification"
          value="UNCLASSIFIED // FRIEND OF OPERATOR"
        />
      </div>

      <label className="mt-6 flex cursor-pointer items-start gap-3 border border-console-line p-4 text-sm leading-relaxed text-console-bright">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => onAcknowledgedChange(event.target.checked)}
          className="mt-1 accent-console-amber"
        />
        I acknowledge that this object is a real person and not a synthetic
        record generated to test the pipeline.
      </label>
    </TitledPanel>
  );
}
