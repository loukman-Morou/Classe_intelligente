import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Email invalide.' })
  email!: string;

  @IsString()
  @MinLength(2, { message: 'Le prénom doit contenir au moins 2 caractères.' })
  @MaxLength(50)
  firstName!: string;

  @IsString()
  @MinLength(2, { message: 'Le nom doit contenir au moins 2 caractères.' })
  @MaxLength(50)
  lastName!: string;

  /**
   * Politique de mot de passe : 8 caractères min, 1 majuscule, 1 chiffre.
   * Volontairement raisonnable (contexte mobile/Afrique).
   */
  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit contenir au moins 8 caractères.' })
  @MaxLength(128)
  @Matches(/^(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Le mot de passe doit contenir au moins une majuscule et un chiffre.',
  })
  password!: string;
}
