import { z } from "zod";
import source from "../../../../content/operator-login.json";
const text = z.string().trim().min(1).max(600);
export const operatorLoginContent = z.object({ dashboardTitle: text, accessNote: text, unavailable: text, retry: text, otherEntry: text, customerEntry: text, catalogNote: text, customersNote: text, fulfillmentsNote: text, permissionsNote: text, deniedTitle: text, deniedNote: text, title: text, lead: text, signIn: text, signOut: text,
  disabledTitle: text, disabledNote: text, error: text, signedInTitle: text, boundNote: text, unboundNote: text,
  registration: text, registrationNote: text, home: text }).strict().parse(source);
