'use client';

import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import { ActionFailure, useCatalogueAction } from '@/components/organisms/CatalogueAdmin';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { categoryNameLabels } from '@/modules/taxonomy/category-tree';
import { createCategorySchema, updateCategorySchema } from '@/modules/taxonomy/taxonomy.schema';

export type CategoryNodeItem = Readonly<{
  id: string;
  parentId: string | null;
  level: number;
  name: string;
  slug: string;
  path: string;
  isActive: boolean;
  position: number;
  childCount: number;
  directProductCount: number;
  productCount: number;
}>;

type Dialog =
  | { kind: 'create'; parent: CategoryNodeItem | null }
  | { kind: 'rename'; node: CategoryNodeItem }
  | { kind: 'move'; node: CategoryNodeItem };

const topLevel = '__top__';
const formId = 'category-form';

function sortedChildren(nodes: readonly CategoryNodeItem[], parentId: string | null) {
  return nodes
    .filter((node) => node.parentId === parentId)
    .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
}

function moveTargets(nodes: readonly CategoryNodeItem[], node: CategoryNodeItem) {
  const labels = categoryNameLabels(nodes);
  return [
    { value: topLevel, label: 'Top level' },
    ...nodes
      .filter((candidate) => !candidate.path.startsWith(node.path) && candidate.level < 4)
      .map((candidate) => ({
        value: candidate.id,
        label: labels.get(candidate.id) ?? candidate.name,
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
  ];
}

function TreeLevel({
  nodes,
  parentId,
  canWrite,
  pendingKey,
  onAction,
}: Readonly<{
  nodes: readonly CategoryNodeItem[];
  parentId: string | null;
  canWrite: boolean;
  pendingKey: string | null;
  onAction: (
    action: 'add' | 'rename' | 'move' | 'toggle' | 'delete',
    node: CategoryNodeItem,
  ) => void;
}>) {
  const children = sortedChildren(nodes, parentId);
  if (children.length === 0) return null;
  return (
    <ul
      className={
        parentId === null
          ? 'flex flex-col gap-sm'
          : 'mt-sm flex flex-col gap-sm border-l border-lowlight pl-md'
      }
    >
      {children.map((node) => (
        <li key={node.id}>
          <div className="flex flex-col gap-xs rounded-default border border-lowlight bg-white p-md md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-sm">
              <Text variant="body2-medium">{node.name}</Text>
              <Text variant="body3" tone="muted">
                L{node.level} · {node.productCount}{' '}
                {node.productCount === 1 ? 'product' : 'products'}
              </Text>
              {node.isActive ? null : <Badge tone="warning">inactive</Badge>}
            </div>
            {canWrite ? (
              <div className="flex flex-wrap gap-xs">
                {node.level < 4 && node.directProductCount === 0 ? (
                  <Button
                    size="sm"
                    iconBefore="plus"
                    onClick={() => {
                      onAction('add', node);
                    }}
                  >
                    Add under {node.name}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  iconBefore="pencil"
                  onClick={() => {
                    onAction('rename', node);
                  }}
                >
                  Rename {node.name}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    onAction('move', node);
                  }}
                >
                  Move {node.name}
                </Button>
                <Button
                  size="sm"
                  appearance="subtle"
                  isLoading={pendingKey === `toggle-${node.id}`}
                  onClick={() => {
                    onAction('toggle', node);
                  }}
                >
                  {node.isActive ? 'Deactivate' : 'Activate'} {node.name}
                </Button>
                {node.childCount === 0 && node.directProductCount === 0 ? (
                  <Button
                    size="sm"
                    appearance="subtle"
                    iconBefore="trash"
                    onClick={() => {
                      onAction('delete', node);
                    }}
                  >
                    Delete {node.name}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          <TreeLevel
            nodes={nodes}
            parentId={node.id}
            canWrite={canWrite}
            pendingKey={pendingKey}
            onAction={onAction}
          />
        </li>
      ))}
    </ul>
  );
}

export function CategoryTreeManager({
  nodes,
  canWrite,
}: Readonly<{ nodes: readonly CategoryNodeItem[]; canWrite: boolean }>) {
  const { run, pendingKey, failure, clearFailure } = useCatalogueAction();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [moveTarget, setMoveTarget] = useState(topLevel);
  const [toDelete, setToDelete] = useState<CategoryNodeItem | null>(null);

  function open(next: Dialog) {
    clearFailure();
    setFieldErrors({});
    if (next.kind === 'move') setMoveTarget(next.node.parentId ?? topLevel);
    setDialog(next);
  }

  function handleAction(
    action: 'add' | 'rename' | 'move' | 'toggle' | 'delete',
    node: CategoryNodeItem,
  ) {
    if (action === 'add') open({ kind: 'create', parent: node });
    if (action === 'rename') open({ kind: 'rename', node });
    if (action === 'move') open({ kind: 'move', node });
    if (action === 'delete') setToDelete(node);
    if (action === 'toggle') {
      void run(
        `toggle-${node.id}`,
        {
          url: `/api/admin/categories/${node.id}/status`,
          method: 'POST',
          body: { isActive: !node.isActive },
        },
        node.isActive ? 'Category deactivated' : 'Category activated',
      );
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog === null) return;
    const read = formReader(event.currentTarget);
    if (dialog.kind === 'move') {
      const saved = await run(
        'save',
        {
          url: `/api/admin/categories/${dialog.node.id}/move`,
          method: 'POST',
          body: { parentId: moveTarget === topLevel ? null : moveTarget },
        },
        'Category moved',
      );
      if (saved !== null) setDialog(null);
      return;
    }
    const entered = {
      name: read('name'),
      ...(read('slug').trim() === '' ? {} : { slug: read('slug') }),
    };
    const parsed =
      dialog.kind === 'create'
        ? createCategorySchema.safeParse({ ...entered, parentId: dialog.parent?.id ?? null })
        : updateCategorySchema.safeParse(entered);
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    const saved = await run(
      'save',
      dialog.kind === 'create'
        ? { url: '/api/admin/categories', method: 'POST', body: parsed.data }
        : { url: `/api/admin/categories/${dialog.node.id}`, method: 'PATCH', body: parsed.data },
      dialog.kind === 'create' ? 'Category created' : 'Category updated',
    );
    if (saved !== null) setDialog(null);
  }

  const title =
    dialog === null
      ? ''
      : dialog.kind === 'create'
        ? dialog.parent === null
          ? 'New top-level category'
          : `New category under ${dialog.parent.name}`
        : dialog.kind === 'rename'
          ? `Rename ${dialog.node.name}`
          : `Move ${dialog.node.name}`;
  const errors = { ...fieldErrors, ...(failure?.fieldErrors ?? {}) };

  return (
    <div className="flex flex-col gap-lg">
      {dialog === null ? <ActionFailure failure={failure} /> : null}
      {canWrite ? (
        <div>
          <Button
            appearance="primary"
            iconBefore="plus"
            onClick={() => {
              open({ kind: 'create', parent: null });
            }}
          >
            New top-level category
          </Button>
        </div>
      ) : null}
      {nodes.length === 0 ? (
        <EmptyState
          icon="folder-tree"
          headingLevel={2}
          title="No categories yet"
          description="Build the tree up to four levels deep, then tag products to its leaves."
        />
      ) : (
        <section aria-label="Category tree">
          <TreeLevel
            nodes={nodes}
            parentId={null}
            canWrite={canWrite}
            pendingKey={pendingKey}
            onAction={handleAction}
          />
        </section>
      )}
      <Modal
        open={dialog !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDialog(null);
        }}
        title={title}
        footer={
          <>
            <Button
              onClick={() => {
                setDialog(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              appearance="primary"
              isLoading={pendingKey === 'save'}
            >
              Save
            </Button>
          </>
        }
      >
        {dialog === null ? null : (
          <form
            id={formId}
            noValidate
            className="flex flex-col gap-md"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <ActionFailure failure={failure} />
            {dialog.kind === 'move' ? (
              <SelectField
                label="New parent"
                name="parentId"
                options={moveTargets(nodes, dialog.node)}
                value={moveTarget}
                onValueChange={setMoveTarget}
                hint="The whole subcategory tree moves with it."
              />
            ) : (
              <>
                <FormField
                  label="Name"
                  name="name"
                  defaultValue={dialog.kind === 'rename' ? dialog.node.name : ''}
                  error={errors['name']}
                  autoComplete="off"
                />
                <FormField
                  label="Slug (optional)"
                  name="slug"
                  defaultValue={dialog.kind === 'rename' ? dialog.node.slug : ''}
                  hint="Made from the name if left empty. Changing it changes the address of every subcategory."
                  error={errors['slug']}
                  autoComplete="off"
                />
              </>
            )}
          </form>
        )}
      </Modal>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setToDelete(null);
        }}
        title={`Delete ${toDelete?.name ?? 'category'}?`}
        description="Only empty categories without subcategories can be deleted. This cannot be undone."
        confirmLabel="Delete category"
        isPending={pendingKey === 'delete'}
        onConfirm={() => {
          if (toDelete === null) return;
          void run(
            'delete',
            { url: `/api/admin/categories/${toDelete.id}`, method: 'DELETE' },
            'Category deleted',
          ).then(() => {
            setToDelete(null);
          });
        }}
      />
    </div>
  );
}
