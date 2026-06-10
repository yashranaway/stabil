"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { professionalAnswersSchema, type ProfessionalAnswers } from "@stabil/types";

import { Checkbox, Field, NumberInput, RatingSlider, Select } from "./fields";

const DEFAULTS: ProfessionalAnswers = {
  mode: "professional",
  totalExperienceYears: 5,
  averageTenureMonths: 24,
  spokenLanguagesCount: 2,
  age: 30,
  maritalStatus: "single",
  communicationSelfRating: 4,
  communicationCertified: false,
  yearsAtCurrentLocation: 4,
  verifiedDocumentsCount: 0,
};

export function ProfessionalForm({
  onSubmit,
  submitting,
}: {
  onSubmit: (answers: ProfessionalAnswers) => void;
  submitting: boolean;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ProfessionalAnswers>({
    resolver: zodResolver(professionalAnswersSchema),
    defaultValues: DEFAULTS,
  });

  const v = watch();

  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <h2 className="form-section">Experience</h2>

      <Field label="Total experience (years)" error={errors.totalExperienceYears}>
        <NumberInput<ProfessionalAnswers>
          name="totalExperienceYears"
          min={0}
          max={50}
          step={0.5}
          register={register}
        />
      </Field>

      <Field
        label="Average tenure per job (months)"
        error={errors.averageTenureMonths}
      >
        <NumberInput<ProfessionalAnswers>
          name="averageTenureMonths"
          min={0}
          max={600}
          register={register}
        />
      </Field>

      <Field label="Spoken languages" error={errors.spokenLanguagesCount}>
        <NumberInput<ProfessionalAnswers>
          name="spokenLanguagesCount"
          min={1}
          max={15}
          register={register}
        />
      </Field>

      <h2 className="form-section">Personal</h2>

      <Field label="Age" sensitive error={errors.age}>
        <NumberInput<ProfessionalAnswers> name="age" min={16} max={90} register={register} />
      </Field>

      <Field label="Marital status" sensitive error={errors.maritalStatus}>
        <Select<ProfessionalAnswers>
          name="maritalStatus"
          register={register}
          options={[
            { value: "single", label: "Single" },
            { value: "married", label: "Married" },
            { value: "other", label: "Other" },
          ]}
        />
      </Field>

      <h2 className="form-section">Communication &amp; settledness</h2>

      <Field
        label="Communication self-rating (1–5)"
        error={errors.communicationSelfRating}
      >
        <RatingSlider<ProfessionalAnswers>
          name="communicationSelfRating"
          value={v.communicationSelfRating}
          register={register}
        />
      </Field>

      <Field label="Communication certificate" error={errors.communicationCertified}>
        <Checkbox<ProfessionalAnswers>
          name="communicationCertified"
          label="I hold a communication cert (IELTS / TOEFL / etc.)"
          register={register}
        />
      </Field>

      <Field
        label="Years at current location"
        error={errors.yearsAtCurrentLocation}
      >
        <NumberInput<ProfessionalAnswers>
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
        <NumberInput<ProfessionalAnswers>
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
