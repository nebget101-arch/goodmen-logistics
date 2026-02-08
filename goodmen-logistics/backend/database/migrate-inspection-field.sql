-- Migration: Rename last_inspection_date to inspection_expiry
-- Description: This migration renames the last_inspection_date column to inspection_expiry
--              to better reflect that it stores when the inspection expires, not when it was last performed.
-- Date: 2025-01-XX

-- Check if column exists before renaming (prevents errors on re-run)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'vehicles' 
        AND column_name = 'last_inspection_date'
    ) THEN
        -- Rename the column
        ALTER TABLE vehicles 
        RENAME COLUMN last_inspection_date TO inspection_expiry;
        
        RAISE NOTICE 'Column last_inspection_date renamed to inspection_expiry successfully';
    ELSE
        RAISE NOTICE 'Column last_inspection_date does not exist or already renamed';
    END IF;
END $$;

-- Verify the change
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'vehicles' 
AND column_name = 'inspection_expiry';
