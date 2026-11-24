import pandas as pd

def duplicate_emails(employee: pd.DataFrame) -> pd.DataFrame:
    return employee.loc[employee.duplicated(subset=["email"]), ["email"]].drop_duplicates()
