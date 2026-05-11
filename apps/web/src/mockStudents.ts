import type { StudentDirectoryItem } from "./types";

export const mockStudents: StudentDirectoryItem[] = [
  {
    id: "STD-001",
    fullName: "Amina Diallo",
    className: "Grade 6 - A",
    guardianPhone: "+225070000001",
    hasBiometric: true
  },
  {
    id: "STD-002",
    fullName: "Noah Mensah",
    className: "Grade 7 - C",
    guardianPhone: "+225070000002",
    hasBiometric: true
  },
  {
    id: "STD-003",
    fullName: "Leila Kouassi",
    className: "Grade 5 - B",
    guardianPhone: "+225070000003",
    hasBiometric: true
  },
  {
    id: "STD-004",
    fullName: "Jayden Okoro",
    className: "Grade 8 - A",
    guardianPhone: "+225070000004",
    hasBiometric: false
  }
];
