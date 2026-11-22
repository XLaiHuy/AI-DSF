import type Decimal from 'decimal.js'

// Financial calculations will use Decimal internally and serialize amounts as strings at the API boundary.
export type FinancialDecimal = Decimal
export interface EmiEngine {}
export interface AprIrrEngine {}
export interface DtiEngine {}
export interface OpenFundDcaEngine {}
