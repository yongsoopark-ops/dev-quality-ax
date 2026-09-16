import { getEquipmentRows, getFacilityAssigneeOptions } from "@/lib/facility/queries";
import { ReservationClient } from "./ReservationClient";

export default async function FacilityReservationPage() {
  const [rows, assigneeOptions] = await Promise.all([getEquipmentRows(), getFacilityAssigneeOptions()]);
  return <ReservationClient initialRows={rows} assigneeOptions={assigneeOptions} />;
}
