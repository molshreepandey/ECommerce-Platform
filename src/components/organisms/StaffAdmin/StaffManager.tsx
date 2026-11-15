'use client';

import { type SubmitEvent, useState } from 'react';
import { Badge } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { Checkbox } from '@/components/atoms/Checkbox';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { FormField } from '@/components/molecules/FormField';
import { formReader } from '@/lib/form-values';
import { useAdminAction } from '../AdminActions/use-admin-action';

export type StaffRoleChoice = Readonly<{ code: string; name: string }>;
export type StaffMemberView = Readonly<{
  id: string;
  fullName: string;
  email: string;
  status: 'ACTIVE' | 'DEACTIVATED';
  lastLoginLabel: string;
  roles: readonly StaffRoleChoice[];
}>;

type Dialog =
  | { kind: 'create' }
  | { kind: 'roles'; member: StaffMemberView }
  | { kind: 'status'; member: StaffMemberView };

function RoleChoices({
  roles,
  selected,
  onChange,
  error,
}: Readonly<{
  roles: readonly StaffRoleChoice[];
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  error: string | undefined;
}>) {
  return (
    <fieldset className="flex flex-col gap-sm">
      <legend className="mb-xs text-body3-medium text-headings">Roles</legend>
      {error === undefined ? null : <InlineAlert tone="danger">{error}</InlineAlert>}
      {roles.map((role) => (
        <Checkbox
          key={role.code}
          label={role.name}
          checked={selected.has(role.code)}
          onCheckedChange={(checked) => {
            const next = new Set(selected);
            if (checked === true) next.add(role.code);
            else next.delete(role.code);
            onChange(next);
          }}
        />
      ))}
    </fieldset>
  );
}

// D3 (super admin only): add staff, change their roles, deactivate or reactivate. The API refuses
// changes to one's own account and keeps at least one active super admin.
export function StaffManager({
  members,
  roles,
  currentStaffUserId,
}: Readonly<{
  members: readonly StaffMemberView[];
  roles: readonly StaffRoleChoice[];
  currentStaffUserId: string;
}>) {
  const { run, isPending, failure, clearFailure } = useAdminAction();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<ReadonlySet<string>>(new Set());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const errorFor = (field: string) => fieldErrors[field] ?? failure?.fieldErrors[field];

  function open(next: Dialog) {
    clearFailure();
    setFieldErrors({});
    setSelectedRoles(
      new Set(next.kind === 'roles' ? next.member.roles.map(({ code }) => code) : []),
    );
    setDialog(next);
  }

  async function submitCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = formReader(event.currentTarget);
    if (selectedRoles.size === 0) {
      setFieldErrors({ roleCodes: 'Choose at least one role.' });
      return;
    }
    setFieldErrors({});
    const saved = await run(
      {
        url: '/api/admin/staff',
        method: 'POST',
        body: {
          fullName: text('fullName'),
          email: text('email'),
          password: text('password'),
          roleCodes: [...selectedRoles],
        },
      },
      'Staff member added',
    );
    if (saved !== null) setDialog(null);
  }

  async function submitRoles(member: StaffMemberView) {
    if (selectedRoles.size === 0) {
      setFieldErrors({ roleCodes: 'Choose at least one role.' });
      return;
    }
    const saved = await run(
      {
        url: `/api/admin/staff/${member.id}/roles`,
        method: 'PUT',
        body: { roleCodes: [...selectedRoles] },
      },
      'Roles saved',
    );
    if (saved !== null) setDialog(null);
  }

  async function toggleStatus(member: StaffMemberView) {
    const status = member.status === 'ACTIVE' ? 'DEACTIVATED' : 'ACTIVE';
    const saved = await run(
      { url: `/api/admin/staff/${member.id}/status`, method: 'POST', body: { status } },
      status === 'ACTIVE' ? 'Staff member reactivated' : 'Staff member deactivated',
    );
    if (saved !== null) setDialog(null);
  }

  return (
    <div className="flex flex-col gap-md">
      <div>
        <Button
          appearance="primary"
          iconBefore="plus"
          onClick={() => {
            open({ kind: 'create' });
          }}
        >
          Add staff member
        </Button>
      </div>
      {dialog === null && failure !== null ? (
        <InlineAlert tone="danger">{failure.message}</InlineAlert>
      ) : null}
      <ul aria-label="Staff members" className="flex flex-col gap-sm">
        {members.map((member) => {
          const isSelf = member.id === currentStaffUserId;
          return (
            <li
              key={member.id}
              className="flex flex-col gap-sm rounded-default border border-lowlight bg-white p-md md:flex-row md:items-center md:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-xs">
                <Text variant="body2-medium">
                  {member.fullName}
                  {isSelf ? ' (you)' : ''}
                </Text>
                <Text variant="body3" tone="muted">
                  {member.email} · last sign-in {member.lastLoginLabel}
                </Text>
                <div className="flex flex-wrap gap-xs">
                  <Badge tone={member.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {member.status === 'ACTIVE' ? 'active' : 'deactivated'}
                  </Badge>
                  {member.roles.map((role) => (
                    <Badge key={role.code} tone="info">
                      {role.name}
                    </Badge>
                  ))}
                </div>
              </div>
              {isSelf ? null : (
                <div className="flex flex-wrap gap-sm">
                  <Button
                    size="sm"
                    onClick={() => {
                      open({ kind: 'roles', member });
                    }}
                  >
                    Change roles
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      open({ kind: 'status', member });
                    }}
                  >
                    {member.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Modal
        open={dialog?.kind === 'create'}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDialog(null);
        }}
        title="Add a staff member"
        description="They sign in on the admin site with this email and password."
        footer={
          <>
            <Button
              onClick={() => {
                setDialog(null);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-staff-form"
              appearance="primary"
              isLoading={isPending}
            >
              Add staff member
            </Button>
          </>
        }
      >
        {failure === null || failure.code === 'VALIDATION_FAILED' ? null : (
          <InlineAlert tone="danger">{failure.message}</InlineAlert>
        )}
        <form
          id="create-staff-form"
          noValidate
          className="flex flex-col gap-md"
          onSubmit={(event) => void submitCreate(event)}
        >
          <FormField label="Full name" name="fullName" error={errorFor('fullName')} />
          <FormField label="Email" name="email" type="email" error={errorFor('email')} />
          <FormField
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            hint="At least 12 characters. Share it with them privately."
            error={errorFor('password')}
          />
          <RoleChoices
            roles={roles}
            selected={selectedRoles}
            onChange={setSelectedRoles}
            error={errorFor('roleCodes')}
          />
        </form>
      </Modal>
      <Modal
        open={dialog?.kind === 'roles'}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDialog(null);
        }}
        title={dialog?.kind === 'roles' ? `Roles of ${dialog.member.fullName}` : ''}
        description="The new roles apply on their next request."
        footer={
          <>
            <Button
              onClick={() => {
                setDialog(null);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              appearance="primary"
              isLoading={isPending}
              onClick={() => {
                if (dialog?.kind === 'roles') void submitRoles(dialog.member);
              }}
            >
              Save roles
            </Button>
          </>
        }
      >
        {failure === null ? null : <InlineAlert tone="danger">{failure.message}</InlineAlert>}
        <RoleChoices
          roles={roles}
          selected={selectedRoles}
          onChange={setSelectedRoles}
          error={errorFor('roleCodes')}
        />
      </Modal>
      <ConfirmDialog
        open={dialog?.kind === 'status'}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDialog(null);
        }}
        title={
          dialog?.kind === 'status'
            ? `${dialog.member.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'} ${dialog.member.fullName}?`
            : ''
        }
        description={
          dialog?.kind === 'status' && dialog.member.status === 'ACTIVE'
            ? 'They are signed out everywhere and cannot sign in until reactivated.'
            : 'They can sign in again with their existing password.'
        }
        confirmLabel={
          dialog?.kind === 'status' && dialog.member.status === 'ACTIVE'
            ? 'Deactivate'
            : 'Reactivate'
        }
        isPending={isPending}
        onConfirm={() => {
          if (dialog?.kind === 'status') void toggleStatus(dialog.member);
        }}
      />
    </div>
  );
}
