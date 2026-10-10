import { IsUUID } from 'class-validator';

export class SetCoOwnerDto {
  /** userId du membre à promouvoir co-responsable. Doit déjà être membre de la classe. */
  @IsUUID('4')
  userId!: string;
}
