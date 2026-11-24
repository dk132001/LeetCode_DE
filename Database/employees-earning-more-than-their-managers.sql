# Write your MySQL query statement below
SELECT a.name as Employee
FROM employee a
JOIN employee b
  ON a.managerId = b.id
WHERE a.salary > b.salary;
