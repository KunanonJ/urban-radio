'use client';

import { useState, useCallback } from 'react';
import { Plus, Clock } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { TemplateCard } from '@/features/clock-templates/components/template-card';
import { ClockTemplateFormDialog } from '@/features/clock-templates/components/clock-template-form-dialog';
import {
  useClockTemplates,
  useCreateClockTemplate,
  useUpdateClockTemplate,
  useDeleteClockTemplate,
} from '@/features/clock-templates/hooks/use-clock-templates';
import type { ClockTemplateFormValues } from '@/lib/validators/clock-template.schema';
import type { ClockTemplate } from '@/types';

export default function ClockTemplatesPage() {
  const { data: templates = [], isLoading } = useClockTemplates();
  const createMutation = useCreateClockTemplate();
  const updateMutation = useUpdateClockTemplate();
  const deleteMutation = useDeleteClockTemplate();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ClockTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClockTemplate | null>(null);

  const handleCreate = useCallback(
    (values: ClockTemplateFormValues) => {
      createMutation.mutate(
        { ...values, segments: [] } as Omit<ClockTemplate, 'id' | 'createdAt' | 'updatedAt'>,
        { onSuccess: () => setFormOpen(false) },
      );
    },
    [createMutation],
  );

  const handleUpdate = useCallback(
    (values: ClockTemplateFormValues) => {
      if (!editTarget) return;
      updateMutation.mutate(
        { id: editTarget.id, data: values },
        { onSuccess: () => setEditTarget(null) },
      );
    },
    [editTarget, updateMutation],
  );

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  }, [deleteTarget, deleteMutation]);

  const handleClone = useCallback(
    (template: ClockTemplate) => {
      createMutation.mutate({
        name: `${template.name} (Copy)`,
        description: template.description,
        daypart: template.daypart,
        timezone: template.timezone,
        segments: template.segments.map((s) => ({ ...s })),
      } as Omit<ClockTemplate, 'id' | 'createdAt' | 'updatedAt'>);
    },
    [createMutation],
  );

  return (
    <div>
      <PageHeader
        title="Clock Templates"
        description="Define hourly programming structures"
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Template
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={<Clock className="h-12 w-12" />}
          title="No templates yet"
          description="Create your first clock template to define hour structures."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onEdit={setEditTarget}
              onDelete={setDeleteTarget}
              onClone={handleClone}
            />
          ))}
        </div>
      )}

      <ClockTemplateFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={handleCreate}
        loading={createMutation.isPending}
      />

      <ClockTemplateFormDialog
        open={!!editTarget}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        onSubmit={handleUpdate}
        template={editTarget}
        loading={updateMutation.isPending}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Template"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
