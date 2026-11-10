-- Wave 5: stock received from a supplier gets its own movement type.
-- On its own because Postgres cannot use a new enum value in the transaction that adds it, and the next
-- migration's CHECK uses it.

-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'RECEIPT';
