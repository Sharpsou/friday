/**
 * Mapping public de la reprise ponctuelle. Il ne contient aucune valeur réelle.
 * La transformation des classeurs s'exécute hors runtime et produit le JSON
 * validé par BudgetSeedSchema sous D:\FridayData.
 */
export const BUDGET_SEED_MAPPING = {
  version: 'budget-seed-v1',
  sources: {
    recent: {
      priority: 1,
      workbook: 'budget_simple_v2/Budget_simple_2026_2027.xlsx',
      sheets: {
        regularIncome: 'Revenus fixes',
        fixedExpenses: 'Frais fixes',
        plannedExpenses: 'Prévisionnel',
        occasional: 'Occasionnels',
      },
    },
    envelopesOnly: {
      priority: 2,
      workbook: 'budget_2026_27/Budget_familial_2026_2027.xlsx',
      sheet: 'Enveloppes',
      range: 'A1:Q13',
    },
  },
  rules: {
    currency: 'EUR',
    zeroOrToConfirm: 'inactive_draft',
    householdOwner: null,
    duplicateResolution: 'recent_source_wins',
    personMatching: 'normalized_exact_name_or_stop',
    identifiers: 'deterministic_from_version_section_and_business_key',
  },
} as const;
