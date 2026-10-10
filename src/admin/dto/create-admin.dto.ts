import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateAdminDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  firstName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  lastName!: string;

  /**
   * Politique de mot de passe admin plus stricte que les utilisateurs ordinaires :
   * 12 caractères minimum, majuscule, minuscule, chiffre, caractère spécial.
   */
  @IsString()
  @MinLength(12)
  @MaxLength(72)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])/, {
    message:
      'Le mot de passe doit contenir au moins une majuscule, une minuscule, ' +
      'un chiffre et un caractère spécial (!@#$%^&*…).',
  })
  password!: string;
}
