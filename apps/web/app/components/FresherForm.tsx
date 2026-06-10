"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { fresherAnswersSchema, type FresherAnswers } from "@stabil/types";

import { Checkbox, Field, NumberInput, RatingSlider, Select } from "./fields";

const DEFAULTS: FresherAnswers = {
  mode: "fresher",
  academicsPercentage: 75,
  projectsCount: 2,
  programmingLanguagesCount: 2,
  aiFamiliarity: 3,
  cloudExposure: 2,
  certificationsCount: 1,
  willingToRelocate: true,
  flexibility: 3,
  workMode: "hybrid",
  communicationSelfRating: 3,
  communicationCertified: false,
  yearsAtCurrentLocation: 3,
  verifiedDocumentsCount: 0,
};

export function FresherForm({
  onSubmit,
  submitting,
  prefill,
}: {
  onSubmit: (answers: FresherAnswers) => void;
  submitting: boolean;
  prefill?: Partial<FresherAnswers>;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FresherAnswers>({
    resolver: zodResolver(fresherAnswersSchema),
    defaultValues: { ...DEFAULTS, ...prefill },
  });

  const v = watch();

  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <h2 className="form-section">Education &amp; skills</h2>

      <Field label="Academic score (%)" error={errors.academicsPercentage}>
        <NumberInput<FresherAnswers>
          name="academicsPercentage"
          min={0}
          max={100}
          step={0.1}
          register={register}
        />
      </Field>

      <Field label="Number of projects" error={errors.projectsCount}>
        <NumberInput<FresherAnswers> name="projectsCount" min={0} max={50} register={register} />
      </Field>

      <Field
        label="Programming languages known"
        error={errors.programmingLanguagesCount}
      >
        <NumberInput<FresherAnswers>
          name="programmingLanguagesCount"
          min={0}
          max={20}
          register={register}
        />
      </Field>

      <Field label="AI familiarity (1–5)" error={errors.aiFamiliarity}>
        <RatingSlider<FresherAnswers> name="aiFamiliarity" value={v.aiFamiliarity} register={register} />
      </Field>

      <Field label="Cloud exposure (1–5)" error={errors.cloudExposure}>
        <RatingSlider<FresherAnswers> name="cloudExposure" value={v.cloudExposure} register={register} />
      </Field>

      <Field label="Courses &amp; certifications" error={errors.certificationsCount}>
        <NumberInput<FresherAnswers>
          name="certificationsCount"
          min={0}
          max={50}
          register={register}
        />
      </Field>

      <h2 className="form-section">Work preferences</h2>

      <Field label="Willingness to relocate" error={errors.willingToRelocate}>
        <Checkbox<FresherAnswers>
          name="willingToRelocate"
          label="I'm open to relocating for the right role"
          register={register}
        />
      </Field>

      <Field label="Flexibility (1–5)" error={errors.flexibility}>
        <RatingSlider<FresherAnswers> name="flexibility" value={v.flexibility} register={register} />
      </Field>

      <Field label="Preferred work mode" error={errors.workMode}>
        <Select<FresherAnswers>
          name="workMode"
          register={register}
          options={[
            { value: "onsite", label: "On-site" },
            { value: "hybrid", label: "Hybrid" },
            { value: "remote", label: "Remote" },
          ]}
        />
      </Field>

      <h2 className="form-section">Communication &amp; settledness</h2>

      <Field
        label="Communication self-rating (1–5)"
        error={errors.communicationSelfRating}
      >
        <RatingSlider<FresherAnswers>
          name="communicationSelfRating"
          value={v.communicationSelfRating}
          register={register}
        />
      </Field>

      <Field label="Communication certificate" error={errors.communicationCertified}>
        <Checkbox<FresherAnswers>
          name="communicationCertified"
          label="I hold a communication cert (IELTS / TOEFL / etc.)"
          register={register}
        />
      </Field>

      <Field
        label="Years at current location"
        error={errors.yearsAtCurrentLocation}
      >
        <NumberInput<FresherAnswers>
          name="yearsAtCurrentLocation"
          min={0}
          max={80}
          step={0.5}
          register={register}
        />
      </Field>

      <Field
        label="Verified documents"
        hint="Documents you've had verified (0 for now)."
        error={errors.verifiedDocumentsCount}
      >
        <NumberInput<FresherAnswers>
          name="verifiedDocumentsCount"
          min={0}
          max={10}
          register={register}
        />
      </Field>

      <button type="submit" className="btn-primary" disabled={submitting}>
        {submitting ? "Scoring…" : "Get my score"}
      </button>
    </form>
  );
}
